/*
@rootVar: EC_POOL_DATA_BUTTON
@name: Experiment Pool Data Button
@version: 1.0.0
@description: Adds a “Pool Data” button into the Experiment toolbar
@requiredElabVersion: 2.35.0
@author: Extracellular
*/

var EC_POOL_DATA_BUTTON = {};

(function (context) {

  function load_SheetJS() {
    return new Promise((resolve, reject) => {
      if (window.XLSX) {
        // already loaded
        return resolve();
      }

      // create a script element pointing at the SheetJS bundle
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.onload = () => {
        console.log("EC_POOL_DATA_BUTTON: SheetJS loaded successfully.");
        resolve();
      };
      script.onerror = () => {
        console.error("EC_POOL_DATA_BUTTON: Failed to load SheetJS.");
        reject(new Error("Failed to load SheetJS"));
      };
      // append the script to the document head
      document.head.appendChild(script);
    });
  }

  // had problems using eLab SDK API call so just gonna do it manually
  // bytes is a Uint8Array of XLSX bytes
  async function upload_excel_bytes(new_section_id, bytes) {
    const upload_url = `${window.location.origin}/api/v1/experiments/sections/${new_section_id}/excel`;
    const response = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: bytes
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to upload Excel file: ${response.status} ${response.statusText} - ${text}`);
    }
    return response;
  }

  // wrap eLabSDK.API.Call in a promise so that we can await it
  function api_call(opts) {
    return new Promise((resolve, reject) => {
      eLabSDK.API.call(Object.assign({}, opts, {
        onSuccess: (_xhr, _status, resp) => resolve(resp),
        onError: (_xhr, _status, error) => reject({error})
      })); 
    });
  }

  // prompt the user for comma-separated descriptors (e.g. "Actual PCV, Raw PCV, …")
  function prompt_for_labels() {
    return new Promise((resolve) => {
      if (eLabSDK2.UI.Modal) {
        const modal = eLabSDK2.UI.Modal.create({
          title: "Pool Data: Enter Descriptors",
          content: `
            <div>
              <p>Enter descriptors separated by commas (e.g. Actual PCV, Raw PCV)</p>
              <input 
                id="poolLabelsInput" 
                type="text"
                style="width:100%; font-family:inherit; font-size:14px; padding:4px;"
                placeholder="Actual PCV, Raw PCV, …">
            </div>
            <div style="margin-top:10px; text-align:right;">
              <button id="poolLabelsOk" class="btn btn-primary">OK</button>
              <button id="poolLabelsCancel" class="btn btn-secondary">Cancel</button>
            </div>
          `,
          width: 450,
        });
        modal.open();

        modal.getElement().querySelector("#poolLabelsOk").addEventListener("click", () => {
          const raw = modal.getElement().querySelector("#poolLabelsInput").value;
          modal.close();
          // split labels on commas
          const labels = raw
            .split(",")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
          resolve(labels);
        });
        modal.getElement().querySelector("#poolLabelsCancel").addEventListener("click", () => {
          modal.close();
          resolve(null);
        });
      } else {
        // fallback to prompt() if Modal is unavailable
        const raw = window.prompt("Enter descriptors separated by commas (e.g. Actual PCV, Raw PCV):");
        if (raw === null) {
          return resolve(null);
        }
        const labels = raw
          .split(",")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        resolve(labels);
      }
    });
  }

  // Normalise label: 
  // turn null/undef into empty string
  // replace NBSP with normal space
  // collapse any sequence of whitespace
  // remove spaces immediately inside brackets
  // strip leading/trailing whitespace
  // strip trailing colon and lowercase
  function normalise_label(s) {
    let t = (s || "").replace(/\u00a0/g, " ");
    t = t.replace(/\s+/g, " ");
    t = t.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
    t = t.trim().replace(/:$/, "").toLowerCase();
    return t; 
  }

  // Preserve signs, dots and E/e for scientific notation
  function clean_numeric_string(s) {
    return Array.from(s).filter(ch => /[0-9Ee\+\-\.]/.test(ch)).join("");
  }

  // Pool Data!
  // 1. ask for the labels (like in the python script)
  // 2. GET /experiments/{expID}/sections, filter by PROCEDURE
  // 3. For each, GET /experiments/sections/{secID}/html, parse the HTML for each label
  // 4. Build XLSX workbook
  // 5. POST /experiments/{expID}/sectons (sectionType: EXCEL)
  // 6. PUT /experiments/sections/{newSectionID}/excel (upload the bytes)
  // 7. show toasts and handle errors

  async function pool_data(expID, expData) {
    if (!expID) {
      eLabSDK2.UI.Toast.showToast('Experiment ID is not defined!');
      console.error("EC_POOL_DATA_BUTTON: Experiment ID is not defined.");
      return;
    }
    try {
      // 1. ask for the labels
      const labels = await prompt_for_labels();
      if (!labels || labels.length === 0) {
        eLabSDK2.UI.Toast.showToast('No labels provided!');
        console.error("EC_POOL_DATA_BUTTON: No labels provided.");
        return;
      }

      console.log("EC_POOL_DATA_BUTTON: Labels received:", labels);
      eLabSDK2.UI.Toast.showToast('Pooling data... please wait');

      let procedure_sections = [];

      // 2. GET /experiments/{expID}/sections, filter by PROCEDURE
      // if expData.data is present use that to gather PROCEDURE sections
      if (expData && Array.isArray(expData.data)) {
        procedure_sections = expData.data.filter((section) => section.sectionType === "PROCEDURE");
        console.log(`EC_POOL_DATA_BUTTON: Found ${procedure_sections.length} PROCEDURE sections in expData.`);
      }

      // Otherwise fall back to the API call
      if (procedure_sections.length === 0) {
        console.log("EC_POOL_DATA_BUTTON: No PROCEDURE sections found in expData, fetching from API.");
        let sections_resp;
        try {
          sections_resp = await api_call({
            method: 'GET',
            path: 'experiments/{expID}/sections',
            pathParams: { expID: expID }
          });
        } catch (error) {
          eLabSDK2.UI.Toast.showToast(`Error fetching sections for experiment ${expID}`);
          console.error(`EC_POOL_DATA_BUTTON: Error fetching sections for experiment ${expID}:`, error);
          return;
        }
        
        const all_sections = sections_resp.data || sections_resp; 
        procedure_sections = all_sections.filter((section) => section.sectionType === "PROCEDURE").map((section) => {
          // Only return header fields
          return {
            expJournalID: section.expJournalID,
            sectionHeader: section.sectionHeader
          };
        });
        console.log(`EC_POOL_DATA_BUTTON: Found ${procedure_sections.length} PROCEDURE sections in API response.`);
      }

      if (procedure_sections.length === 0) {
        eLabSDK2.UI.Toast.showToast('No PROCEDURE sections found in the experiment!');
        console.error("EC_POOL_DATA_BUTTON: No PROCEDURE sections found in the experiment.");
        return;
      }

      // 3. For each, GET /experiments/sections/{secID}/html, parse the HTML for each label
      const rows = [];
      for (const section of procedure_sections) {
        let html_text = null;
        // if expData provided "contents", use that
        if (section.contents) {
          html_text = section.contents;
        } else {
          // otherwise fetch the HTML from the API
          try {
            const html_resp = await api_call({
              method: 'GET',
              path: 'experiments/sections/{expJournalID}/html',
              pathParams: { expJournalID: section.expJournalID }
            });
            html_text = html_resp.data || html_resp.html || html_resp;
          } catch (error) {
            eLabSDK2.UI.Toast.showToast(`Error fetching HTML for section ${section.expJournalID}`);
            console.error(`EC_POOL_DATA_BUTTON: Error fetching HTML for section ${section.expJournalID}:`, error);
            continue; // skip this section if there's an error
          }
        }

        // Now parse the HTML for each label
        const parser = new DOMParser();
        const doc = parser.parseFromString(html_text, 'text/html');
        const row_obj = { SectionHeader: section.sectionHeader};

        // try extract mathching <span> value for each label
        labels.forEach((label) => {
          const target = normalise_label(label);
          let found_val = null;

          Array.from(doc.querySelectorAll("tr")).some((tr) => {
            const cells = Array.from(tr.querySelectorAll("td"));
            if (cells.length >= 2) {
              const raw_cell_text = cells[0].textContent;
              const cell_label = normalise_label(raw_cell_text);
              console.log(`EC_POOL_DATA_BUTTON: Checking label "${cell_label}" against target "${target}"`);
              if (cell_label === target) {
                const span = cells[1].querySelector("span");
                if (span) {
                  let v = span.textContent.trim();
                  // strip non-digits - THIS IS VERY EXTRACELLULAR-SPECIFIC CHANGE IF NEEDED
                  if (!["cell id"].includes(target)) {
                      v = clean_numeric_string(v);
                  }
                  found_val = v;
                  console.log(`EC_POOL_DATA_BUTTON: Found value "${found_val}" for label "${label}"`);
                }
                return true; // stop searching this row
              }
            }
            return false; // continue searching this row
          });

          // if not found yet, second pass: 2-row tables
          if (found_val === null) {
            Array.from(doc.querySelectorAll("table")).some((table) => {
              const rows2 = Array.from(table.querySelectorAll("tr"));
              if (rows2.length >= 2) {
                const hdr_cells = Array.from(rows2[0].querySelectorAll("td"));
                const val_cells = Array.from(rows2[1].querySelectorAll("td"));
                for (let i = 0; i < hdr_cells.length; i++) {
                  const hdr = normalise_label(hdr_cells[i].textContent);
                  console.log(`EC_POOL_DATA_BUTTON: Checking header "${hdr}" against target "${target}"`);
                  if (hdr === target && i < val_cells.length) {
                    const span = val_cells[i].querySelector("span");
                    if (span) {
                      let v = span.textContent.trim();
                      if (!["cell id"].includes(target)) {
                        v = clean_numeric_string(v);
                      }
                      console.log(`EC_POOL_DATA_BUTTON: Found value "${v}" for label "${label}" in 2-row table`);
                      found_val = v;
                    }
                    return true; // break out of this table’s loop
                  }
                }
              }
              return false;
            });

          }
          
          row_obj[label] = found_val; 
        });

        rows.push(row_obj);
      } // end for each section

      if (rows.length === 0) {
        eLabSDK2.UI.Toast.showToast("No data found for any label");
        return; // might take this off ???
      }

      // 4. Build the workbook - build XLSX wb with SheetJS and then write binary string to array buffer

      // Load SheetJS if not already loaded
      try {
        await load_SheetJS();
      } catch (error) {
        eLabSDK2.UI.Toast.showToast('Error loading SheetJS library');
        console.error("EC_POOL_DATA_BUTTON: Error loading SheetJS library:", error);
        return;
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pooled Data");

      const wbOut = XLSX.write(wb, {bookType: "xlsx", type: "binary"});
      const buf = new ArrayBuffer(wbOut.length);
      const view = new Uint8Array(buf);
      for (let i=0; i<wbOut.length; ++i) {
        view[i] = wbOut.charCodeAt(i) & 0xFF;
      }

      
      // 5. Create new EXCEL experiment section
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      const section_header = `Pooled Data - ${timestamp}`;
      let new_section_id;
      try {
        const create_resp = await api_call({
          method: 'POST',
          path: 'experiments/{expID}/sections',
          pathParams: { expID: expID },
          body: {
            sectionType: "EXCEL",
            sectionHeader: section_header,
            sectionDate: timestamp.split(" ")[0]
          }
        });
        new_section_id = create_resp || create_resp.data || create_resp.expJournalID;
        console.log(`EC_POOL_DATA_BUTTON: Created new section with ID: ${new_section_id}`);
      } catch (error) {
        console.error(`EC_POOL_DATA_BUTTON: Error creating new section for experiment ${expID}:`, error);
        eLabSDK2.UI.Toast.showToast(`Error creating new section for experiment ${expID}`);
        return;
      }

      // 6. Upload the Excel file to the new section
      try {
        await upload_excel_bytes(new_section_id, buf);
        console.log(`EC_POOL_DATA_BUTTON: Successfully uploaded Excel file to section ${new_section_id}`);
      } catch (error) {
        console.error(`EC_POOL_DATA_BUTTON: Error uploading Excel file to section ${new_section_id}:`, error);
        eLabSDK2.UI.Toast.showToast(`Error uploading Excel file to section ${new_section_id}`);
        return;
      }

      // 7. Show success toast
      eLabSDK2.UI.Toast.showToast(`Pooled data saved to new section: ${section_header}, PLEASE REFRESH THE PAGE`);
      console.log(`EC_POOL_DATA_BUTTON: Pooled data saved to new section: ${section_header}, PLEASE REFRESH THE PAGE`);
    } catch (error) {
      console.error("EC_POOL_DATA_BUTTON: An error occurred while pooling data:", error);
      eLabSDK2.UI.Toast.showToast('An error occurred while pooling data. Check console for details.');
    }
  }
      
  // ---------------------------------------------------------------
  // inserting button into the Experiment Action Buttons + into Navbar for redundancy
  // also just in case
  // ---------------------------------------------------------------
  context.init = function () {
    console.log("EC_POOL_DATA_BUTTON:init() called");

    function try_insert_button() {
        // locate UL that holds all experiment action <li> items
        const ul = document.querySelector("#experimentactionbuttons ul#options");
        if (!ul) {
            console.warn("EC_POOL_DATA_BUTTON: Could not find the experiment action buttons UL element.");
            return false;
        }

        // if button already inserted
        if (document.getElementById("poolDataInBodyButton")) {
            console.warn("EC_POOL_DATA_BUTTON: Button already exists, not inserting again.");
            return true;
        }

        // locate <span id="sdk2actions">
        const sdk2actions = ul.querySelector("#sdk2actions");
        if (!sdk2actions) {
            console.warn("EC_POOL_DATA_BUTTON: Could not find the sdk2actions span element.");
            return false;
        }

        // build new <li> element
        const li = document.createElement("li");
        li.id = "poolDataInBodyButton";
        li.style.display = "inherit"; 

        // inside the <li> create the <a> with icon + text
        const a = document.createElement("a");
        a.title = "Pool Data";
        a.classList.add("addIcon");
        a.style.cursor = "pointer";

        // create <i> icon
        const icon = document.createElement("i");
        icon.classList.add("fas", "fa-table");
        icon.style.marginRight = "4px"; // Add some space between icon and text

        const txt = document.createTextNode("Pool Data");

        a.appendChild(icon);
        a.appendChild(txt);

        // attach click handler to <a>
        a.addEventListener("click", (e) => {
            e.preventDefault();
            console.log("EC_POOL_DATA_BUTTON: In-Body Pool Data button clicked");
            ep = new eLabSDK.Page.Experiment();
            expID = ep.getExperimentID();
            expData = ep.getExperimentData();
            console.log(`Experiment ID: ${expID}`);
            eLabSDK2.UI.Toast.showToast('Pool Data clicked!');
            pool_data(expID, expData);
        });

        li.appendChild(a);

        ul.insertBefore(li, sdk2actions);

        return true;
    }

    let attempts = 0;
    const interval = setInterval(() => {
        if (try_insert_button() || attempts++ > 20) {
            clearInterval(interval);
            if (attempts > 20) {
                console.warn("EC_POOL_DATA_BUTTON: Failed to insert button after multiple attempts.");
            } else {
                // console.log("EC_POOL_DATA_BUTTON: Button inserted successfully.");
                console.log("EC_POOL_DATA_BUTTON: Button inserted successfully.");
            }
        }
    }, 500);

    // Define the minimal button config using 'action' instead of 'onClick'
    const poolDataNavButton = {
      id: 'poolDataNavButton',
      label: 'Pool Data',
      icon: 'fas fa-table',
      action: () => {
        console.log("EC_POOL_DATA_BUTTON: Nav-Bar Pool Data button clicked");
        ep = new eLabSDK.Page.Experiment();
        expID = ep.getExperimentID();
        expData = ep.getExperimentData();
        console.log(`Experiment ID: ${expID}`);
        eLabSDK2.UI.Toast.showToast('Pool Data clicked!');
        pool_data(expID, expData);
      }
    };

    // Documentation is confusing and not sure so basically try everything and see what happens:
    // Try the Journal-Experiment Navigation first
    if (
      eLabSDK2.Journal &&
      eLabSDK2.Journal.Experiment &&
      eLabSDK2.Journal.Experiment.UI &&
      eLabSDK2.Journal.Experiment.UI.Navigation &&
      typeof eLabSDK2.Journal.Experiment.UI.Navigation.addMainMenuAction === 'function'
    ) {
      console.log(
        "EC_POOL_DATA_BUTTON: Registering via eLabSDK2.Journal.Experiment.UI.Navigation.addMainMenuAction"
      );
      eLabSDK2.Journal.Experiment.UI.Navigation.addMainMenuAction(poolDataNavButton);
      return;
    }

    // Fallback to the older Section Navigation namespace
    if (
      eLabSDK2.Experiment &&
      eLabSDK2.Experiment.Section &&
      eLabSDK2.Experiment.Section.UI &&
      eLabSDK2.Experiment.Section.UI.Navigation &&
      typeof eLabSDK2.Experiment.Section.UI.Navigation.addMainMenuAction === 'function'
    ) {
      console.log(
        "EC_POOL_DATA_BUTTON: Registering via eLabSDK2.Experiment.Section.UI.Navigation.addMainMenuAction"
      );
      eLabSDK2.Experiment.Section.UI.Navigation.addMainMenuAction(poolDataNavButton);
      return;
    }

    console.warn(
      "EC_POOL_DATA_BUTTON: Couldn't find a Navigation API to add a main‐menu button."
    );
  };
})(EC_POOL_DATA_BUTTON);
